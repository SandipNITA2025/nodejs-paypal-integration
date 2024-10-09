const axios = require("axios");
const pool = require("../config/db");

// Generate PayPal access token
async function generateAccessToken() {
  const response = await axios({
    url: process.env.PAYPAL_BASE_URL + "/v1/oauth2/token",
    method: "post",
    data: "grant_type=client_credentials",
    auth: {
      username: process.env.PAYPAL_CLIENT_ID,
      password: process.env.PAYPAL_SECRET,
    },
  });
  return response.data.access_token;
}

// Create PayPal order and store in PostgreSQL (with ACID transaction)
exports.createOrder = async (userId, items, couponCode, billingDetails) => {
  const client = await pool.connect();
  let totalAmount = 0;

  try {
    await client.query("BEGIN"); // Begin transaction

    // Check if user exists
    const userResult = await client.query(
      "SELECT user_id FROM Users WHERE user_id = $1",
      [userId]
    );
    if (userResult.rows.length === 0) {
      throw new Error("User does not exist");
    }

    // Calculate total amount from items
    items.forEach((item) => {
      totalAmount += item.quantity * item.price;
    });

    // Apply coupon discount if available
    if (couponCode) {
      const couponResult = await client.query(
        "SELECT discount_value, discount_type FROM Coupons WHERE coupon_code = $1 AND expiry_date > NOW()",
        [couponCode]
      );
      if (couponResult.rows.length > 0) {
        const coupon = couponResult.rows[0];
        if (coupon.discount_type === "percentage") {
          totalAmount -= totalAmount * (coupon.discount_value / 100);
        } else {
          totalAmount -= coupon.discount_value;
        }
      }
    }

    // Insert billing details
    const billingResult = await client.query(
      "INSERT INTO Billing (user_id, full_name, email, phone, address_line_1, address_line_2, city, state, postal_code, country) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING billing_id",
      [
        userId,
        billingDetails.full_name,
        billingDetails.email,
        billingDetails.phone,
        billingDetails.address_line_1,
        billingDetails.address_line_2,
        billingDetails.city,
        billingDetails.state,
        billingDetails.postal_code,
        billingDetails.country,
      ]
    );
    const billingId = billingResult.rows[0].billing_id;

    // Insert order into Orders table
    const orderResult = await client.query(
      "INSERT INTO Orders (user_id, total_amount, coupon_code, billing_id) VALUES ($1, $2, $3, $4) RETURNING order_id",
      [userId, totalAmount, couponCode, billingId]
    );
    const orderId = orderResult.rows[0].order_id;

    // Create PayPal order
    const accessToken = await generateAccessToken();
    const paypalResponse = await axios({
      url: process.env.PAYPAL_BASE_URL + "/v2/checkout/orders",
      method: "post",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      data: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            amount: {
              currency_code: "USD",
              value: totalAmount.toFixed(2),
            },
          },
        ],
        application_context: {
          return_url: process.env.BASE_URL + "/complete-order",
          cancel_url: process.env.BASE_URL + "/cancel-order",
          user_action: "PAY_NOW",
          brand_name: "Your App",
        },
      }),
    });

    const paypalOrderId = paypalResponse.data.id;
    const approvalUrl = paypalResponse.data.links.find(
      (link) => link.rel === "approve"
    ).href;

    // Update order with PayPal order ID
    await client.query(
      "UPDATE Orders SET paypal_order_id = $1 WHERE order_id = $2",
      [paypalOrderId, orderId]
    );

    await client.query("COMMIT"); // Commit transaction

    return { orderId, paypalOrderId, paypalUrl: approvalUrl };
  } catch (error) {
    await client.query("ROLLBACK"); // Rollback transaction
    throw Error("[createOrder]" + error.message);
  } finally {
    client.release();
  }
};

// Capture PayPal payment and store in Payments table
exports.capturePayment = async (paypalOrderId, userId) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN"); // Begin transaction

    // Fetch internal order ID using PayPal order ID
    const orderResult = await client.query(
      "SELECT order_id FROM Orders WHERE paypal_order_id = $1",
      [paypalOrderId]
    );

    if (orderResult.rows.length === 0) {
      throw new Error("Order not found for the given PayPal order ID");
    }

    const internalOrderId = orderResult.rows[0].order_id;

    // Generate PayPal access token and capture payment
    const accessToken = await generateAccessToken();
    const response = await axios({
      url: `${process.env.PAYPAL_BASE_URL}/v2/checkout/orders/${paypalOrderId}/capture`,
      method: "post",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const capturedPayment = response.data;
    const transactionId =
      capturedPayment.purchase_units[0].payments.captures[0].id;
    const amount =
      capturedPayment.purchase_units[0].payments.captures[0].amount.value;

    // Update Orders and Payments table
    await client.query(
      "UPDATE Orders SET payment_status = $1 WHERE order_id = $2",
      ["paid", internalOrderId]
    );

    await client.query(
      "INSERT INTO Payments (user_id, order_id, amount, transaction_id, payment_status, paypal_order_id) VALUES ($1, $2, $3, $4, $5, $6)",
      [userId, internalOrderId, amount, transactionId, "paid", paypalOrderId]
    );

    await client.query("COMMIT"); // Commit transaction

    return { success: true, message: "Payment captured successfully" };
  } catch (error) {
    await client.query("ROLLBACK"); // Rollback transaction
    throw Error("[CAPTURE PAYMENT] " + error.message);
  } finally {
    client.release();
  }
};

// Process refund payment
exports.refundPayment = async (paymentId, refundAmount, userId) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN"); // Begin transaction

    // Fetch the payment details using the payment ID
    const paymentResult = await client.query(
      "SELECT * FROM Payments WHERE payment_id = $1 AND user_id = $2",
      [paymentId, userId]
    );

    if (paymentResult.rows.length === 0) {
      throw new Error("Payment not found or does not belong to the user");
    }

    const payment = paymentResult.rows[0];

    // Check if the refund amount is valid
    if (refundAmount > payment.amount) {
      throw new Error("Refund amount exceeds the original payment amount");
    }

    // Generate PayPal access token
    const accessToken = await generateAccessToken();

    // Create the refund request
    const refundResponse = await axios({
      url: `${process.env.PAYPAL_BASE_URL}/v2/payments/captures/${payment.transaction_id}/refund`,
      method: "post",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      data: {
        amount: {
          currency_code: "USD",
          value: refundAmount,
        },
      },
    });

    const refundTransactionId = refundResponse.data.id;
    const refundStatus = refundResponse.data.status;

    // Insert refund record into Refunds table
    await client.query(
      "INSERT INTO Refunds (payment_id, user_id, refund_amount, refund_status, refund_transaction_id) VALUES ($1, $2, $3, $4, $5)",
      [paymentId, userId, refundAmount, refundStatus, refundTransactionId]
    );

    await client.query("COMMIT"); // Commit transaction

    return {
      success: true,
      message: "Refund processed successfully",
      refundTransactionId,
    };
  } catch (error) {
    await client.query("ROLLBACK"); // Rollback transaction
    throw new Error("[REFUND PAYMENT] " + error.message);
  } finally {
    client.release();
  }
};

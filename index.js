require("dotenv").config();
const express = require("express");
const paypal = require("./services/paypal");

const app = express();
app.set("view engine", "ejs");
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Render the initial form
app.get("/", (req, res) => {
  res.render("index");
});

// Payment creation route
app.post("/pay", async (req, res) => {
  const { userId, items, couponCode, billingDetails } = req.body;
  try {
    const parsedItems = JSON.parse(items);
    const parsedBillingDetails = JSON.parse(billingDetails);

    const { paypalUrl } = await paypal.createOrder(
      userId,
      parsedItems,
      couponCode,
      parsedBillingDetails
    );
    res.redirect(paypalUrl);
  } catch (error) {
    res.status(500).send("Error: " + error.message);
  }
});

// Capture payment route after approval
app.get("/complete-order", async (req, res) => {
  try {
    const { token, userId } = req.query; // PayPal order token and userId
    await paypal.capturePayment(token, userId);
    res.send("Order and Payment completed successfully");
  } catch (error) {
    res.status(500).send("Error: " + error.message);
  }
});

// Cancel payment route
app.get("/cancel-order", (req, res) => {
  res.redirect("/");
});

// Refund payment route
app.post("/refund", async (req, res) => {
  const { paymentId, refundAmount, userId } = req.body;
  try {
    const result = await paypal.refundPayment(paymentId, refundAmount, userId);
    res.json(result);
  } catch (error) {
    res.status(500).send("Error: " + error.message);
  }
});

app.listen(3000, () => console.log("Server running on port 3000"));
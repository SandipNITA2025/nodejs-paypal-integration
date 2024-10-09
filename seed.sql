-- Users Table
CREATE TABLE Users (
    user_id BIGSERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    phone VARCHAR(15),
    address VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Orders Table
CREATE TABLE Orders (
    order_id BIGSERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES Users(user_id) ON DELETE CASCADE,
    order_status VARCHAR(20) CHECK (
        order_status IN (
            'PENDING',
            'PROCESSING',
            'COMPLETED',
            'CANCELLED'
        )
    ) DEFAULT 'PENDING',
    total_amount DECIMAL(10, 2) NOT NULL,
    coupon_code VARCHAR(50),
    payment_status VARCHAR(20) CHECK (payment_status IN ('PAID', 'UNPAID')) DEFAULT 'UNPAID',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Billing Table
CREATE TABLE Billing (
    billing_id BIGSERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES Users(user_id) ON DELETE CASCADE,
    full_name VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL,
    phone VARCHAR(15),
    address_line_1 VARCHAR(255) NOT NULL,
    address_line_2 VARCHAR(255),
    city VARCHAR(100) NOT NULL,
    state VARCHAR(50) NOT NULL,
    postal_code VARCHAR(20) NOT NULL,
    country VARCHAR(100) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Payments Table
CREATE TABLE Payments (
    payment_id BIGSERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES Users(user_id) ON DELETE CASCADE,
    order_id BIGINT REFERENCES Orders(order_id) ON DELETE CASCADE,
    payment_method VARCHAR(20) NOT NULL,
    transaction_id VARCHAR(100),
    amount DECIMAL(10, 2) NOT NULL,
    payment_status VARCHAR(20) CHECK (
        payment_status IN ('PENDING', 'COMPLETED', 'FAILED')
    ),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Coupons Table
CREATE TABLE Coupons (
    coupon_id BIGSERIAL PRIMARY KEY,
    coupon_code VARCHAR(50) UNIQUE NOT NULL,
    discount_value DECIMAL(10, 2) NOT NULL,
    discount_type VARCHAR(10) CHECK (discount_type IN ('PERCENTAGE', 'AMOUNT')),
    coupon_description VARCHAR(255),
    start_date TIMESTAMP WITH TIME ZONE NOT NULL,
    expiry_date TIMESTAMP WITH TIME ZONE NOT NULL,
    max_uses INT,
    current_uses INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Refunds Table
CREATE TABLE Refunds (
    refund_id BIGSERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES Users(user_id) ON DELETE CASCADE,
    payment_id BIGINT REFERENCES Payments(payment_id) ON DELETE CASCADE,
    order_id BIGINT REFERENCES Orders(order_id) ON DELETE CASCADE,
    refund_amount DECIMAL(10, 2) NOT NULL,
    refund_status VARCHAR(20) CHECK (
        refund_status IN ('PENDING', 'COMPLETED', 'FAILED')
    ),
    reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance optimization
CREATE INDEX idx_users_email ON Users(email);

CREATE INDEX idx_orders_user_id ON Orders(user_id);

CREATE INDEX idx_orders_status ON Orders(order_status, payment_status);

CREATE INDEX idx_payments_order_id ON Payments(order_id);

CREATE INDEX idx_payments_user_id ON Payments(user_id);

CREATE INDEX idx_coupons_code ON Coupons(coupon_code);

CREATE INDEX idx_coupons_expiry_date ON Coupons(expiry_date);

CREATE INDEX idx_refunds_user_id ON Refunds(user_id);

CREATE INDEX idx_refunds_payment_id ON Refunds(payment_id);

-- Add updated_at triggers
CREATE
OR REPLACE FUNCTION update_modified_column() RETURNS TRIGGER AS $ $ BEGIN NEW.updated_at = CURRENT_TIMESTAMP;

RETURN NEW;

END;

$ $ LANGUAGE plpgsql;

CREATE TRIGGER update_users_modtime BEFORE
UPDATE
    ON Users FOR EACH ROW EXECUTE FUNCTION update_modified_column();



ALTER TABLE Orders ADD COLUMN billing_id BIGINT REFERENCES Billing(billing_id);

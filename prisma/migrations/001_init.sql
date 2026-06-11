-- Omix SACCO Database Schema
-- Run this on Neon PostgreSQL to set up the database

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255),
    phone VARCHAR(50),
    avatar_url TEXT,
    role VARCHAR(20) CHECK (role IN ('ADMIN', 'STAFF', 'MEMBER')) DEFAULT 'MEMBER',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Savings table
CREATE TABLE IF NOT EXISTS savings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount DECIMAL(12,2) NOT NULL CHECK (amount >= 0),
    transaction_type VARCHAR(20) CHECK (transaction_type IN ('DEPOSIT', 'WITHDRAWAL')) NOT NULL,
    status VARCHAR(20) CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED')) DEFAULT 'COMPLETED',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Loans table
CREATE TABLE IF NOT EXISTS loans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount DECIMAL(12,2) NOT NULL CHECK (amount > 0),
    interest_rate DECIMAL(5,2) NOT NULL,
    duration_months INTEGER NOT NULL CHECK (duration_months > 0),
    purpose TEXT,
    status VARCHAR(20) CHECK (status IN ('PENDING', 'APPROVED', 'DISBURSED', 'REPAID', 'REJECTED')) DEFAULT 'PENDING',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Transactions table
CREATE TABLE IF NOT EXISTS transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(30) CHECK (type IN ('SAVINGS', 'LOAN_REPAYMENT')) NOT NULL,
    amount DECIMAL(12,2) NOT NULL CHECK (amount > 0),
    mpesa_receipt VARCHAR(100) UNIQUE,
    status VARCHAR(20) CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED')) DEFAULT 'PENDING',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Guarantors table
CREATE TABLE IF NOT EXISTS guarantors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    loan_id UUID NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
    guarantor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(20) CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')) DEFAULT 'PENDING',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(loan_id, guarantor_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_savings_user_id ON savings(user_id);
CREATE INDEX IF NOT EXISTS idx_savings_created_at ON savings(created_at);
CREATE INDEX IF NOT EXISTS idx_loans_user_id ON loans(user_id);
CREATE INDEX IF NOT EXISTS idx_loans_status ON loans(status);
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_guarantors_guarantor_id ON guarantors(guarantor_id);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_updated_at ON users;
CREATE TRIGGER users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS loans_updated_at ON loans;
CREATE TRIGGER loans_updated_at
    BEFORE UPDATE ON loans
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Seed admin user (password: admin123)
INSERT INTO users (email, password_hash, full_name, role)
VALUES (
    'admin@omixsacco.com',
    '$2a$12$LJ3m4ys3Lk8nFgQOIc/MNOxHBMGxPJsGK5bHJKzHSQHJMij4dJXiO',
    'Omix Admin',
    'ADMIN'
)
ON CONFLICT (email) DO NOTHING;

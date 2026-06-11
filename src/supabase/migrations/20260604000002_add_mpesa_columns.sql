-- Add M-Pesa columns to orders table
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS mpesa_checkout_id TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS mpesa_receipt_number TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS phone_number TEXT;

-- Index for faster lookups during callbacks
CREATE INDEX IF NOT EXISTS idx_orders_mpesa_checkout_id ON public.orders(mpesa_checkout_id);

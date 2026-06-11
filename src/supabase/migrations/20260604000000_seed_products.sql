-- Add risk_level to products table
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS risk_level TEXT DEFAULT 'Medium';

-- Seed Products
INSERT INTO public.products (
    name, slug, description, short_description, price_lifetime, price_monthly, 
    win_rate, drawdown, profit_factor, pairs, timeframes, risk_level
) VALUES 
(
    'Elite Scalper v7', 
    'elite-scalper-v7', 
    'A high-frequency scalping EA designed for major pairs. Uses advanced market sentiment analysis and volatility tracking to identify high-probability entries with tight stop-losses.', 
    'High-frequency scalping for major forex pairs with advanced volatility tracking.', 
    499.00, 49.00, 84.5, 5.2, 2.4, 
    ARRAY['EURUSD', 'GBPUSD', 'USDJPY'], ARRAY['M1', 'M5'], 'Medium'
),
(
    'Gold Sniper EA', 
    'gold-sniper-ea', 
    'Specialized in XAUUSD (Gold) trading. This EA utilizes a proprietary trend-following algorithm combined with price action patterns to capture big moves in the gold market.', 
    'Specialized trend-following EA for XAUUSD with high precision entries.', 
    799.00, 79.00, 72.1, 12.4, 3.1, 
    ARRAY['XAUUSD'], ARRAY['M15', 'H1'], 'High'
),
(
    'Steady Trend Pro', 
    'steady-trend-pro', 
    'A conservative trend-following system that focuses on capital preservation and steady growth. Ideal for long-term investors looking for consistent monthly returns.', 
    'Conservative trend-following system focused on long-term capital growth.', 
    349.00, 35.00, 68.4, 3.1, 1.8, 
    ARRAY['EURUSD', 'AUDUSD', 'NZDUSD', 'USDCAD'], ARRAY['H1', 'H4'], 'Low'
)
ON CONFLICT (slug) DO NOTHING;

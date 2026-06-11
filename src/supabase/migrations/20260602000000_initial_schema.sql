-- 1. Profiles (extends auth.users)
CREATE TYPE user_role AS ENUM ('admin', 'customer');

CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT,
    avatar_url TEXT,
    role user_role DEFAULT 'customer',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public profiles are viewable by everyone." ON public.profiles
    FOR SELECT USING (true);

CREATE POLICY "Users can insert their own profile." ON public.profiles
    FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update own profile." ON public.profiles
    FOR UPDATE USING (auth.uid() = id);

-- 2. Products
CREATE TABLE IF NOT EXISTS public.products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    description TEXT,
    short_description TEXT,
    price_lifetime DECIMAL NOT NULL,
    price_monthly DECIMAL NOT NULL,
    win_rate DECIMAL,
    drawdown DECIMAL,
    profit_factor DECIMAL,
    pairs TEXT[] DEFAULT '{}',
    timeframes TEXT[] DEFAULT '{}',
    images TEXT[] DEFAULT '{}',
    documentation_url TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Products are viewable by everyone." ON public.products
    FOR SELECT USING (true);

CREATE POLICY "Only admins can modify products." ON public.products
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
        )
    );

-- 3. Licenses
CREATE TYPE license_status AS ENUM ('active', 'expired', 'revoked');

CREATE TABLE IF NOT EXISTS public.licenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    product_id UUID REFERENCES public.products(id) ON DELETE CASCADE NOT NULL,
    license_key TEXT UNIQUE NOT NULL,
    status license_status DEFAULT 'active',
    activation_count INT DEFAULT 0,
    max_activations INT DEFAULT 1,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.licenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own licenses." ON public.licenses
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Only admins can modify licenses." ON public.licenses
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
        )
    );

-- 4. Orders
CREATE TYPE payment_method AS ENUM ('stripe', 'mpesa', 'crypto');
CREATE TYPE payment_status AS ENUM ('pending', 'completed', 'failed');

CREATE TABLE IF NOT EXISTS public.orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    product_id UUID REFERENCES public.products(id) ON DELETE CASCADE NOT NULL,
    amount DECIMAL NOT NULL,
    currency TEXT DEFAULT 'USD',
    payment_method payment_method,
    payment_status payment_status DEFAULT 'pending',
    transaction_id TEXT UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own orders." ON public.orders
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Only admins can view all orders." ON public.orders
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
        )
    );

-- 5. Trading Stats (Seeded)
CREATE TABLE IF NOT EXISTS public.trading_stats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID REFERENCES public.products(id) ON DELETE CASCADE NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    equity DECIMAL NOT NULL,
    balance DECIMAL NOT NULL,
    profit DECIMAL NOT NULL
);

ALTER TABLE public.trading_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Stats are viewable by everyone." ON public.trading_stats
    FOR SELECT USING (true);

-- 6. Reviews
CREATE TABLE IF NOT EXISTS public.reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    product_id UUID REFERENCES public.products(id) ON DELETE CASCADE NOT NULL,
    rating INT CHECK (rating >= 1 AND rating <= 5),
    comment TEXT,
    is_verified BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Reviews are viewable by everyone." ON public.reviews
    FOR SELECT USING (true);

CREATE POLICY "Users can post reviews." ON public.reviews
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Trigger for profile creation on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, avatar_url, role)
  VALUES (new.id, new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'avatar_url', 'customer');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

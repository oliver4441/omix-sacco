-- License Activations to track hardware IDs
CREATE TABLE IF NOT EXISTS public.license_activations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    license_id UUID REFERENCES public.licenses(id) ON DELETE CASCADE NOT NULL,
    machine_id TEXT NOT NULL,
    ip_address TEXT,
    activated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(license_id, machine_id)
);

ALTER TABLE public.license_activations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own activations." ON public.license_activations
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.licenses
            WHERE licenses.id = license_activations.license_id AND licenses.user_id = auth.uid()
        )
    );

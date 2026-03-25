-- Add rate_reel column to track the real market rate at the time of transfer
-- exchange_rate = taux de paiement (what the client pays)
-- rate_reel = taux réel du marché (from API)
-- majoration = exchange_rate - rate_reel

ALTER TABLE transfers
ADD COLUMN IF NOT EXISTS rate_reel DECIMAL(15, 4);

-- Drop the supplier's locally-stored bank columns. Payouts are handled entirely
-- by Stripe Connect now (stripeAccountId + payoutsEnabled): Stripe collects,
-- verifies and holds the bank account during hosted onboarding, so we no longer
-- keep any raw bank details. These columns were only ever written/displayed and
-- never used to pay anyone; the manual bank-account UI + endpoint are removed.
ALTER TABLE supplier
  DROP COLUMN bankName,
  DROP COLUMN bankAccountName,
  DROP COLUMN bankAccountNumber;

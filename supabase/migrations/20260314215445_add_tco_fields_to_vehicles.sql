/*
  # Add Total Cost of Ownership (TCO) Fields to Vehicles

  ## Summary
  Adds financial fields to the vehicles table to support TCO calculation:
  - purchase_price: What the user paid for the vehicle
  - avg_mpg: Average fuel efficiency (miles per gallon)
  - fuel_price_per_gallon: Current local fuel price
  - insurance_monthly: Monthly insurance cost (optional)

  These fields, combined with existing mileage and service spend data,
  power the TCO dashboard card with cost-per-mile and what-if analysis.

  ## Changes
  - vehicles table: 4 new nullable numeric columns
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vehicles' AND column_name = 'purchase_price'
  ) THEN
    ALTER TABLE vehicles ADD COLUMN purchase_price numeric(10,2);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vehicles' AND column_name = 'avg_mpg'
  ) THEN
    ALTER TABLE vehicles ADD COLUMN avg_mpg numeric(5,1);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vehicles' AND column_name = 'fuel_price_per_gallon'
  ) THEN
    ALTER TABLE vehicles ADD COLUMN fuel_price_per_gallon numeric(5,3);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vehicles' AND column_name = 'insurance_monthly'
  ) THEN
    ALTER TABLE vehicles ADD COLUMN insurance_monthly numeric(8,2);
  END IF;
END $$;

// ChoreSync — fill these in, then save. (This file ships to the browser, so it
// only holds *public* values: the anon key and VAPID public key are safe here.)
window.CHORE_CONFIG = {
  SUPABASE_URL:      "https://YOUR_PROJECT_REF.supabase.co",
  SUPABASE_ANON_KEY: "YOUR_ANON_PUBLIC_KEY",
  HOUSEHOLD_ID:      "YOUR_HOUSEHOLD_ID",        // from schema.sql step 5
  VAPID_PUBLIC_KEY:  "YOUR_VAPID_PUBLIC_KEY",    // from: npx web-push generate-vapid-keys
};

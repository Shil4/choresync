// ChoreSync — fill these in, then save. (This file ships to the browser, so it
// only holds *public* values: the anon key and VAPID public key are safe here.)
window.CHORE_CONFIG = {
  SUPABASE_URL:      "https://mxkjxbndqvdbtuxrakxl.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_3Gu2xuCIV2N5v0EndYcIuA_bcZ-vHqT",
  HOUSEHOLD_ID:      "e95d41dd-58f1-47fc-91a6-e0cd6c48a7f4",        // from schema.sql step 5
  VAPID_PUBLIC_KEY:  "BDoneWetbi_ymnO_Ng_bzpNiLjc0uoWxL4o1VEB2PlxUS-5m2gG9NoMyfj5Ut50elxv6lvmBOVue3Xw4UnFtRXU",    // from: npx web-push generate-vapid-keys
};

--- Customer feedback, filed into folders.
---
--- What customers say about a batch has lived in Messenger and nowhere else.
--- This is the first place the site itself can show it: the admin uploads the
--- screenshot, files it in a folder, and the storefront renders the folder.
---
--- Two tables rather than one with a text `folder` column on the items. A
--- folder has to exist, be renamed, be reordered and be HIDDEN while it is
--- still empty — an admin creates "Batch 7" before Batch 7 has any feedback —
--- and a column on the items cannot represent a folder with no items in it.

CREATE TABLE IF NOT EXISTS "feedback_folders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(80) NOT NULL,

  --- Optional line under the folder name, e.g. "August batch, GLP-1 orders".
  "description" text,

  --- Hidden rather than deleted, and this is the column that matters most for
  --- safety. These are screenshots of real conversations; if one turns out to
  --- carry a phone number or a full name, pulling it has to be one click and
  --- has to be reversible. Deleting the folder would take every screenshot in
  --- it with it, because of the cascade below.
  "is_active" boolean DEFAULT true NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "feedback_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,

  --- Every feedback lives in exactly one folder. NOT NULL is what makes that
  --- true in the database rather than in whichever form happened to submit it,
  --- so there is no unfiled state and therefore no screen for one.
  ---
  --- ON DELETE CASCADE because a folder is the unit an admin actually manages:
  --- deleting "Batch 6 Reviews" means deleting the Batch 6 reviews. The admin
  --- UI names the count in its confirm dialog, and the hide toggle above is the
  --- non-destructive way to take a folder off the storefront.
  "folder_id" uuid NOT NULL REFERENCES "feedback_folders"("id") ON DELETE CASCADE,

  --- Storage key of the screenshot, opaque exactly like payment_methods.qr_key.
  --- Served from the public `feedback` bucket: a testimonial gallery is
  --- marketing material, not a payment proof, so it gets a plain CDN URL rather
  --- than a signed one that expires mid-scroll.
  "image_key" text NOT NULL,

  --- What the customer said, typed by the admin. The screenshot is the
  --- evidence; this is the readable version, because a chat screenshot set in
  --- 11px is unreadable on the phone most of this site is used from.
  "caption" text,

  --- How the customer is credited, e.g. "Ate Jen, Cavite". Free text, NOT a
  --- users FK: the person in a Messenger screenshot may have no account here,
  --- and a real name must never be joined out of the accounts table by
  --- accident. What is printed is what the admin deliberately typed.
  "customer_name" varchar(80),

  "is_active" boolean DEFAULT true NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

--- The storefront's two questions: "which folders do I show" and "what is in
--- this folder". Both filter on is_active, which is why it is indexed on both.
CREATE INDEX IF NOT EXISTS "feedback_folders_active_idx" ON "feedback_folders" ("is_active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feedback_items_folder_idx" ON "feedback_items" ("folder_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feedback_items_active_idx" ON "feedback_items" ("is_active");

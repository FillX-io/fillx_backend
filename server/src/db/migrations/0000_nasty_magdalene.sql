CREATE TABLE "ip_connection_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ip" text NOT NULL,
	"wallet" text NOT NULL,
	"city" text,
	"country" text,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ip_connection_log_ip_idx" ON "ip_connection_log" USING btree ("ip");--> statement-breakpoint
CREATE INDEX "ip_connection_log_wallet_idx" ON "ip_connection_log" USING btree ("wallet");--> statement-breakpoint
CREATE INDEX "ip_connection_log_connected_at_idx" ON "ip_connection_log" USING btree ("connected_at");
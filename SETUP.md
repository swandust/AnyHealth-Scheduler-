# AnyHealth Smart Intake Scheduler — Setup Guide

> Complete this guide once before deploying. Estimated time: **20–30 minutes**.

---

## Overview

This app requires credentials from **3 services**:
1. **Microsoft Entra ID (Azure)** — writes events to your Outlook calendar
2. **Zoom** — creates a unique Zoom meeting for each booking
3. **Resend** — sends branded confirmation emails

---

## Step 1: Microsoft Entra ID (Outlook Calendar Access)

### 1.1 Register the App

1. Go to **[portal.azure.com](https://portal.azure.com)** and sign in with your Microsoft 365 account (`contact@anyhealth.asia`)
2. In the search bar, type **"Microsoft Entra ID"** and click it
3. In the left sidebar, click **"App registrations"**
4. Click **"+ New registration"**
5. Fill in:
   - **Name**: `AnyHealth Booking App`
   - **Supported account types**: `Accounts in this organizational directory only`
   - **Redirect URI**: Leave blank
6. Click **"Register"**
7. On the app overview page, copy:
   - **Application (client) ID** → this is your `MICROSOFT_CLIENT_ID`
   - **Directory (tenant) ID** → this is your `MICROSOFT_TENANT_ID`

### 1.2 Add API Permissions

1. In the left sidebar of your app, click **"API permissions"**
2. Click **"+ Add a permission"**
3. Select **"Microsoft Graph"** → **"Application permissions"**
4. Search for and add:
   - ✅ `Calendars.ReadWrite`
   - ✅ `Mail.Send`
5. Click **"Add permissions"**
6. Click **"✅ Grant admin consent for [your organization]"** (requires admin rights)
7. Confirm — both permissions should show a green ✅

### 1.3 Create Client Secret

1. In the left sidebar, click **"Certificates & secrets"**
2. Click **"+ New client secret"**
3. Set description: `AnyHealth Booking Secret`
4. Set expiry: **24 months** (or your preference)
5. Click **"Add"**
6. **⚠️ Copy the `Value` immediately** — it will never be shown again!
   - This is your `MICROSOFT_CLIENT_SECRET`

> [!CAUTION]
> Store this secret securely. Never commit it to git. Only put it in `.env.local` or Vercel environment variables.

---

## Step 2: Zoom (Server-to-Server OAuth App)

### 2.1 Create the App

1. Go to **[marketplace.zoom.us](https://marketplace.zoom.us)** and sign in
2. Click **"Develop"** → **"Build App"**
3. Select **"Server-to-Server OAuth"** → **"Create"**
4. Name it: `AnyHealth Booking`
5. On the app page, copy:
   - **Account ID** → `ZOOM_ACCOUNT_ID`
   - **Client ID** → `ZOOM_CLIENT_ID`
   - **Client Secret** → `ZOOM_CLIENT_SECRET`

### 2.2 Add Scopes

1. In your app's left menu, click **"Scopes"**
2. Click **"+ Add Scopes"**
3. Under **"Meeting"**, add:
   - ✅ `meeting:write:meeting` (Create a meeting for a user)
4. Click **"Done"**

### 2.3 Activate the App

1. Click **"Activation"** in the sidebar
2. Click **"Activate your app"**
3. Confirm activation

> [!TIP]
> If you want meetings to show in a specific Zoom account (not the app owner's), you can specify the user via their email in the API call. The current implementation uses `users/me` which creates meetings under the app owner's account.

---

## Step 3: Resend (Email Delivery)

### 3.1 Sign Up & Verify Domain

1. Go to **[resend.com](https://resend.com)** and create a free account
2. In the dashboard, click **"Domains"** → **"Add Domain"**
3. Enter `anyhealth.asia`
4. Add the provided DNS records (DKIM, SPF) to your domain registrar
5. Click **"Verify"** — takes 5–15 minutes

### 3.2 Create API Key

1. In the dashboard, click **"API Keys"** → **"Create API Key"**
2. Name: `AnyHealth Booking`
3. Permission: **Full access**
4. Click **"Add"** and copy the key → `RESEND_API_KEY`

---

## Step 4: Configure Environment Variables

Copy `.env.local.example` to `.env.local`:

```bash
cp .env.local.example .env.local
```

Fill in all values:

```env
MICROSOFT_TENANT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
MICROSOFT_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
MICROSOFT_CLIENT_SECRET=your_secret_value

PRACTITIONER_EMAIL=contact@anyhealth.asia

ZOOM_ACCOUNT_ID=your_account_id
ZOOM_CLIENT_ID=your_client_id
ZOOM_CLIENT_SECRET=your_client_secret

RESEND_API_KEY=re_xxxxxxxx
FROM_EMAIL=AnyHealth Booking <booking@anyhealth.asia>

NEXT_PUBLIC_APP_URL=https://anyhealth-scheduler.vercel.app
AVAILABLE_DAYS=1,2,3,4,5,6
```

---

## Step 5: Run Locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and test the full booking flow.

> [!TIP]
> Use a test email address for the first booking to verify everything works before going live.

---

## Step 6: Deploy to Vercel

### 6.1 Push to GitHub

```bash
git init
git add .
git commit -m "Initial AnyHealth scheduler"
git remote add origin https://github.com/YOUR_USERNAME/anyhealth-scheduler.git
git push -u origin main
```

### 6.2 Import to Vercel

1. Go to **[vercel.com](https://vercel.com)** → **"New Project"**
2. Import your GitHub repository
3. Framework preset: **Next.js** (auto-detected)
4. Click **"Environment Variables"** and add all variables from your `.env.local`
5. Click **"Deploy"**

### 6.3 Update APP_URL

After deployment, update `NEXT_PUBLIC_APP_URL` in Vercel to your actual Vercel URL (e.g., `https://anyhealth-scheduler.vercel.app`), then redeploy.

---

## Troubleshooting

| Problem | Solution |
|---|---|
| `Failed to acquire Microsoft Graph token` | Check Tenant ID, Client ID, Client Secret. Confirm admin consent was granted. |
| Outlook event not created | Verify `PRACTITIONER_EMAIL` exactly matches the mailbox. Check `Calendars.ReadWrite` permission has admin consent. |
| Zoom error `Invalid access token` | Check all 3 Zoom credentials. Ensure app is Activated. |
| Email not received | Check spam folder. Verify Resend domain DNS records. Check `FROM_EMAIL` matches verified domain. |
| `409 Conflict` on booking | Time slot no longer available — the user should pick another. |

---

## Security Notes

- ✅ All API credentials are server-side only — never exposed to the browser
- ✅ The Zoom client secret and Microsoft client secret are never in client-side code
- ✅ The booking endpoint validates input server-side
- ⚠️ Consider adding rate limiting (e.g., Vercel's built-in or `@upstash/ratelimit`) before going to high traffic
- ⚠️ Consider restricting Microsoft Graph `Mail.Send` to a single mailbox using Exchange Online PowerShell's `New-ApplicationAccessPolicy`

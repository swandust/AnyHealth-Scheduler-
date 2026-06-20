/**
 * Zoom Server-to-Server OAuth integration.
 * Creates a Zoom meeting for each booking and returns the join URL.
 *
 * Setup: Create a "Server-to-Server OAuth" app in marketplace.zoom.us
 * Required scopes: meeting:write:meeting:admin  (or meeting:write:meeting)
 */

let _zoomToken: { token: string; expiresAt: number } | null = null;

async function getZoomToken(): Promise<string> {
  // Re-use cached token until 5 min before expiry
  if (_zoomToken && Date.now() < _zoomToken.expiresAt - 5 * 60 * 1000) {
    return _zoomToken.token;
  }

  const accountId   = process.env.ZOOM_ACCOUNT_ID!;
  const clientId    = process.env.ZOOM_CLIENT_ID!;
  const clientSecret = process.env.ZOOM_CLIENT_SECRET!;

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const res = await fetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${accountId}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Zoom OAuth error: ${JSON.stringify(err)}`);
  }

  const data = await res.json() as { access_token: string; expires_in: number };
  _zoomToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return _zoomToken.token;
}

export interface ZoomMeeting {
  id: number;
  topic: string;
  join_url: string;
  start_url: string;
  password: string;
  duration: number;
  start_time: string;
}

export async function createZoomMeeting(params: {
  topic: string;
  startIso: string;    // ISO 8601 UTC e.g. "2026-07-10T02:00:00Z"
  durationMinutes: number;
  clientName: string;
  clientEmail: string;
}): Promise<ZoomMeeting> {
  const token = await getZoomToken();

  const body = {
    topic: params.topic,
    type: 2, // Scheduled meeting
    start_time: params.startIso,
    duration: params.durationMinutes,
    timezone: 'Asia/Singapore',
    agenda: `Initial consultation with ${params.clientName}`,
    settings: {
      host_video: true,
      participant_video: true,
      join_before_host: false,
      mute_upon_entry: true,
      waiting_room: true,
      auto_recording: 'none',
      registrants_email_notification: false, // We handle our own emails
    },
  };

  const res = await fetch('https://api.zoom.us/v2/users/me/meetings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Zoom create meeting error: ${JSON.stringify(err)}`);
  }

  return res.json() as Promise<ZoomMeeting>;
}

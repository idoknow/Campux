# Webhook Feature Testing Guide

## Overview
This webhook feature allows administrators to configure webhook URLs that receive POST notifications when article/post status changes.

## Webhook Event Format

When a post status changes, a POST request is sent to all configured webhook URLs with the following JSON payload:

```json
{
  "event": "post_approved",  // Event type
  "post": {                  // Complete post information
    "id": 1,
    "uuid": "...",
    "uin": 12345,
    "text": "Post content",
    "images": ["image1.jpg"],
    "anon": false,
    "status": "approved",
    "created_at": "2024-01-01T00:00:00Z"
  },
  "timestamp": 1234567890    // Unix timestamp when event occurred
}
```

## Event Types

The following events are sent to webhooks:

1. **post_approved** - When a post is approved by an admin
2. **post_rejected** - When a post is rejected by an admin
3. **post_cancelled** - When a user cancels their pending post
4. **post_in_queue** - When an approved post enters the publishing queue
5. **post_published** - When a queued post is successfully published

## Admin UI Usage

1. Navigate to the Admin page
2. Click on the "🪝 Webhook" tab (only visible to admins)
3. Click "添加 Webhook" to add a new webhook URL
4. Enter the complete webhook URL (e.g., https://example.com/webhook)
5. Click "确定" to save
6. The webhook will appear in the list with options to delete

## API Endpoints

### Add Webhook
- **POST** `/v1/admin/add-webhook`
- **Auth**: Admin only
- **Body**: `{ "url": "https://example.com/webhook" }`

### Get Webhooks
- **GET** `/v1/admin/get-webhooks`
- **Auth**: Admin only
- **Response**: `{ "code": 0, "data": { "list": [...] } }`

### Delete Webhook
- **DELETE** `/v1/admin/del-webhook/:id`
- **Auth**: Admin only

## Testing with a Local Webhook Server

You can test webhooks using a simple HTTP server:

```bash
# Using Python 3
python3 -m http.server 8000

# Or using Node.js
npx http-echo-server 8000
```

Then add `http://localhost:8000/webhook` as a webhook URL in the admin panel.

## Implementation Details

- Webhook notifications are sent asynchronously (non-blocking)
- Each webhook has a 10-second timeout
- Failed webhook deliveries do not affect post status changes
- Webhooks are stored in the database with auto-increment IDs

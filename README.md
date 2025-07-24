# API Documentation

This document provides an overview of the API, including its purpose, endpoints, and configuration.

## Overview

The API is a Node.js application built with Express. It serves as the backend for the Modista application, handling course information, payment processing, and user notifications.

## Getting Started

### Prerequisites

- Node.js and npm installed.
- A Mercado Pago account with an access token.
- A WhatsApp Business account with API access (optional, for WhatsApp notifications).
- An email account with SMTP credentials (optional, for email notifications).

### Installation

1. Clone the repository.
2. Navigate to the `api` directory.
3. Install the dependencies:
   ```bash
   npm install
   ```
4. Create a `.env` file in the `api` directory and add the following environment variables:

   ```
   MERCADO_PAGO_ACCESS_TOKEN=your_mercado_pago_access_token
   EMAIL_USER=your_email_user
   EMAIL_PASS=your_email_password
   WHATSAPP_TOKEN=your_whatsapp_token
   WHATSAPP_PHONE_NUMBER_ID=your_whatsapp_phone_number_id
   PORT=3001
   ```

### Running the API

To start the server, run the following command:

```bash
npm run dev
```

The API will be available at `http://localhost:3001`.

## API Endpoints

### Get All Courses

- **URL:** `/api/courses`
- **Method:** `GET`
- **Description:** Retrieves a list of all available courses.
- **Success Response:**
  - **Code:** 200
  - **Content:** `[{ "id": "1", "title": "Course Title", "shortDescription": "...", "longDescription": "...", "imageUrl": "...", "price": "..." }]`
- **Error Response:**
  - **Code:** 500
  - **Content:** `{ "message": "Error getting courses" }`

### Create Payment Preference

- **URL:** `/api/create-preference`
- **Method:** `POST`
- **Description:** Creates a Mercado Pago payment preference.
- **Request Body:**
  ```json
  {
    "id": "course_id",
    "title": "Course Title",
    "price": 100.00,
    "external_reference": "your_external_reference"
  }
  ```
- **Success Response:**
  - **Code:** 200
  - **Content:** `{ "id": "preference_id" }`
- **Error Response:**
  - **Code:** 400, 500
  - **Content:** `{ "error": "Error message" }`

### Payment Success

- **URL:** `/api/payment/success`
- **Method:** `GET`
- **Description:** Handles the redirect from Mercado Pago after a successful payment.
- **Query Parameters:**
  - `payment_id`
  - `status`
  - `external_reference`
  - `merchant_order_id`
- **Redirects:** Redirects to the frontend with payment details.

### Send Purchase Notification

- **URL:** `/api/notifications/success`
- **Method:** `POST`
- **Description:** Sends a purchase notification via email and WhatsApp.
- **Request Body:**
  ```json
  {
    "name": "User Name",
    "email": "user_email",
    "phone": "user_phone_number",
    "courseTitle": "Course Title"
  }
  ```
- **Success Response:**
  - **Code:** 200
  - **Content:** `{ "message": "Notifications sent successfully." }`
- **Error Response:**
  - **Code:** 400, 500
  - **Content:** `{ "message": "Error message" }`

## Services

### Email Service

- **File:** `services/emailServices.js`
- **Description:** Sends emails using Nodemailer. It can be configured to save emails as files for debugging purposes.

### WhatsApp Service

- **File:** `services/whatsAppService.js`
- **Description:** Sends WhatsApp messages using the WhatsApp Business API.

### Template Service

- **File:** `services/fsTemplate.js`
- **Description:** Reads and renders HTML templates.

## Environment Variables

- `MERCADO_PAGO_ACCESS_TOKEN`: Your Mercado Pago access token.
- `EMAIL_USER`: Your email address.
- `EMAIL_PASS`: Your email password.
- `WHATSAPP_TOKEN`: Your WhatsApp Business API token.
- `WHATSAPP_PHONE_NUMBER_ID`: Your WhatsApp phone number ID.
- `PORT`: The port for the API to listen on (default: 3001).
- `EMAIL_MODE`: Set to `file` to save emails locally for testing, or any other value to send emails via SMTP.

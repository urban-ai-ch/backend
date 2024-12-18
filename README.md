# WebDev-Backend

Base URL: `https://webdev-hs24.gerberservices.com/`

## Services

### AI

- POST `ai/v1/detection`

  - Payload:
    ```ts
    type DetectionPayload = {
    	imageName: string;
    	criteria: Criteria;
    };
    ```

### Auth

- POST `/auth/v1/signup`

  - Payload:
    ```ts
    type SignUpPayload = {
    	username: string;
    	password: string;
    	email: string;
    };
    ```

- POST `/auth/v1/signin`

  - Payload:
    ```ts
    type SignInPayload = {
    	username: string;
    	password: string;
    };
    ```
  - Response:
    ```ts
    type AuthTokenResponse = {
    	token: string;
    };
    ```
  - GET `auth/v1/auth`
    - Response: status `200` or `401`

### Geojson

- GET `/geosjon/v1/geojson/{filename}`

  - Response: `image`

### Images

- POST `/images/v1/image`

  - Payload: `image/jpeg`

- GET `/images/v1/image/{filename}`

  - Response: `image`

- DELETE `/images/v1/image/{filename}`

- GET `/images/v1/metadata/{filename}`

  - Response:
    ```ts
    export type Criteria = 'materials' | 'history' | 'seismic';
    export type ImageMetaData = {
    	[key in Criteria]?: string;
    };
    ```

- GET `/images/v1/images`

  - Response:
    ```ts
    type ImagesResponse = {
    	name: string;
    	href: string;
    }[];
    ```

### Mail

- POST `/mail/v1/[broadcast | noah | sai | eren]`

  - Payload:
    ```ts
    type MailPayload = {
    	subject: string;
    	message: string;
    };
    ```

### Payments

- POST `payments/v1/create-checkout-session`

  - Response:
    ```ts
    type OrderResponse = {
    	clientSecret: string;
    };
    ```

- GET `payments/v1/session-status`

  - Response:
    ```ts
    type SessionStatusResponse = {
    	status: string;
    	quantity: number;
    	amount_total: number;
    	customer_email: string | null;
    };
    ```

### Test

- GET `test/v1/ping`

### Tokens

- GET `tokens/v1/self`

  - Response:
    ```ts
    type TokenResponse = {
    	tokenCount: number;
    };
    ```

### Users

- GET `users/v1/me`

  - Response:
    ```ts
    type UserResponse = {
    	username: string;
    	email: string;
    	bio: string;
    };
    ```

- POST `users/v1/me`

  - Payload:
    ```ts
    type UserPayload = {
    	email?: string;
    	bio?: string;
    };
    ```

### Webhooks

- POST `webhooks/v1/stripe`

  - Payload: `Stripe.Event`

- POST `webhooks/v1/replicate`

  - Payload: `ReplicatePrediction<GroundingSamInput>`

# WebDev-Backend

Base URL: `https://webdev-hs24.gerberservices.com/`

## Services

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

### Images

- POST `/images/v1/image`

  - Payload: `image/jpeg`

- GET`/images/v1/image/[imageName].jpg`

  - Response: `[imageName].jpg`

- GET `/images/v1/images`

  - Response:

    ```ts
    type ImagesResponse = {
    	name: string;
    	href: string;
    }[];
    ```

### Test

- GET `/test/v1/ping`

  - Response: "Pong"

- GET `/test/v1/auth`

  - Response: `Auth Status`

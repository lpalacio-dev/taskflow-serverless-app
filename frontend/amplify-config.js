// Usamos las variables de entorno inyectadas por Amplify/Vite
export const amplifyConfig = {
  Auth: {
    Cognito: {
      userPoolId:       import.meta.env.VITE_USER_POOL_ID,
      userPoolClientId: import.meta.env.VITE_USER_POOL_CLIENT_ID,
      loginWith: {
        email: true,
      },
    },
  },
};

export const apiConfig = {
  httpApi: import.meta.env.VITE_HTTP_API,
  wsApi:   import.meta.env.VITE_WS_API,
};
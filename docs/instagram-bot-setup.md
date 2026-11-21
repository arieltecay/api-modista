# Activación del bot en Instagram

El webhook de `Modista APP Bot-IG` (Instagram Login, ID `4433727103579184`) apunta a
`https://api-modista.vercel.app/api/notification/instagram/webhook`. La cuenta
`soymicaguevara` está suscrita al evento `messages`.

## Variables de producción

Configurar estas variables en el proyecto de la API en Vercel y volver a desplegar:

- `META_INSTAGRAM_APP_SECRET`: **clave secreta de la app de Instagram**, no la de la app principal de Meta ni la de WhatsApp.
- `META_INSTAGRAM_ACCESS_TOKEN`: token de usuario de Instagram obtenido en el flujo Instagram Login para `soymicaguevara`, con `instagram_business_manage_messages`.
- `META_INSTAGRAM_USER_ID`: ID de esa cuenta de Instagram.
- `META_INSTAGRAM_VERIFY_TOKEN`: el token de verificación configurado en el webhook.
- `META_INSTAGRAM_API_VERSION`: versión de Graph habilitada para la app (opcional; por defecto `v27.0`).

No pegar secretos ni tokens en el PR, los logs o los comandos de ejemplo. El token
de Instagram Login y el endpoint `graph.instagram.com` deben pertenecer al mismo
flujo de autenticación. El despliegue actual no se debe considerar operativo
hasta validar ambos.

## Verificación después del despliegue

1. Enviar a `/api/notification/instagram/webhook` un evento vacío firmado con el secreto de Instagram: debe responder `200`; con una firma incorrecta debe responder `401`.
2. Enviar un DM de prueba a `soymicaguevara` desde otra cuenta. Comprobar que se guarda como entrante y que el bot responde una sola vez.
3. Consultar una inscripción de prueba aportando email y celular; comprobar que solo se devuelve curso y estado registrado.
4. Revisar Axiom: no deben aparecer errores HMAC para los DMs de prueba ni errores de envío de Graph. Si persisten los 401, revisar la variable de producción y el redeploy antes de modificar el validador.

Instagram responde solo con las instrucciones del admin que tienen activado el canal
y cuya frase coincide con el DM; el resto queda guardado para respuesta humana. Las
respuestas de inscripción vienen de la base de datos, no del modelo, y solo si el
bloque habilita la consulta. La verificación por email y celular limita los datos
mostrados, pero no equivale a un segundo factor.

## Consulta de inscripciones

Desde el admin (Mila AI → Inscripciones) se enciende la consulta por WhatsApp (apagada por defecto) y se editan los textos. En Instagram se habilita por bloque en Entrenamiento y atiende hasta 6 consultas por hora por cuenta.

## Validación local

`npm run test:local:instagram` ejecuta el webhook real contra la BD de `.env` (debe llamarse con `test`, `dev`, `local` o `staging`), con Graph simulado y Gemini real (o `-- --mock-gemini`). Crea datos con prefijo `local-test` y los borra al terminar. No reemplaza la prueba con un DM real.


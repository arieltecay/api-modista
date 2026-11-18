# Contratos de tracking de Meta

- `sendMetaConversionEvent` acepta el evento cuando queda persistido en el outbox; `delivered` indica si Meta confirmó la entrega directa.
- `POST /api/funnel/track` recibe `eventId` y `eventSourceUrl`; para `course_detail_view` valida el ID determinista y toma nombre/precio desde la base de datos.
- El GET completo de landing es una lectura pura y puede cachearse; no debe volver a disparar CAPI.

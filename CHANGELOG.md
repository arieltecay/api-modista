# Changelog

## [Unreleased]
- Agrega los endpoints admin `overview` y `channels` de adquisición (cohorte o período, tres perspectivas de atribución y revenue desde pagos).
- Registra `lead`, `initiate_checkout` y `purchase` server-side en adquisición y el estado de entrega CAPI, con reconciliación desde el outbox.
- Agrega la ingesta de visitas, eventos y señales de Pixel de adquisición (detrás de `ACQUISITION_TRACKING_ENABLED`) y su borrado al revocar el consentimiento.
- Agrega los modelos de visitas, eventos e intentos de señal de adquisición (aún sin endpoints).
- Agrega el clasificador puro de adquisición (plataforma, tipo y canal) que no marca como pago el tráfico orgánico de Instagram, Facebook o Google.
- Aísla la integración de Instagram, valida la firma del webhook y aplica las ventanas de respuesta de Meta.
- Hace durable la entrega CAPI antes de responder, deduplica eventos con IDs estables y expone entregas directas/reintentadas en el diagnóstico.
- Separa `ViewContent` del GET de landing, registra el embudo con consentimiento y habilita caché CDN corta para la lectura pública.
- Exige consentimiento vigente para Meta y elimina señales de navegación al revocarlo.
- Normaliza y valida la IP del cliente en los eventos CAPI de Meta.
- Envía el UUID persistente del navegador como `external_id` consistente entre Pixel y CAPI.
- Elimina payloads CAPI de eventos terminales y cierra pendientes que agotaron sus reintentos.

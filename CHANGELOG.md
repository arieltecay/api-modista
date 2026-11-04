# Changelog

## [Unreleased]
- Aísla la integración de Instagram, valida la firma del webhook y aplica las ventanas de respuesta de Meta.
- Exige consentimiento vigente para Meta y elimina señales de navegación al revocarlo.
- Normaliza y valida la IP del cliente en los eventos CAPI de Meta.
- Envía el UUID persistente del navegador como `external_id` consistente entre Pixel y CAPI.
- Elimina payloads CAPI de eventos terminales y cierra pendientes que agotaron sus reintentos.

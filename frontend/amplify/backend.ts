import { defineBackend } from '@aws-amplify/backend';

/**
 * TaskFlow — backend existente vía SAM.
 *
 * No definimos auth ni API aquí porque ya existen en AWS
 * (creados por nuestro template.yaml de SAM).
 * Solo usamos Amplify para el hosting del frontend.
 *
 * La configuración de los recursos existentes va en
 * src/amplify-config.js (Paso 4.3).
 */
export const backend = defineBackend({});
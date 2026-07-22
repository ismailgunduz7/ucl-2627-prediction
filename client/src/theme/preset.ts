import { definePreset } from '@primevue/themes';
import Aura from '@primevue/themes/aura';

// Champions League vibe: deep indigo primary on a clean neutral surface.
export const AppPreset = definePreset(Aura, {
  semantic: {
    primary: {
      50: '{indigo.50}',
      100: '{indigo.100}',
      200: '{indigo.200}',
      300: '{indigo.300}',
      400: '{indigo.400}',
      500: '{indigo.500}',
      600: '{indigo.600}',
      700: '{indigo.700}',
      800: '{indigo.800}',
      900: '{indigo.900}',
      950: '{indigo.950}',
    },
    colorScheme: {
      light: {
        surface: {
          0: '#ffffff',
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
        },
      },
      dark: {
        surface: {
          0: '#0b1220',
          50: '#111a2e',
          100: '#16223b',
          200: '#1e2d4d',
        },
      },
    },
  },
});

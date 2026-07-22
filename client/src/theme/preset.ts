import { definePreset } from '@primevue/themes';
import Aura from '@primevue/themes/aura';

/**
 * Dark-only Champions League theme. The dark surface scale is tuned to the same
 * navy palette the app's CSS variables use, so PrimeVue overlays (dropdowns,
 * dialogs, toasts) sit on the same colours as our own cards.
 */
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
      dark: {
        surface: {
          0: '#0a0f1d',
          50: '#0e1526',
          100: '#131c31',
          200: '#1a2540',
          300: '#22304f',
          400: '#2c3d61',
          500: '#3a4d75',
          600: '#5a6d94',
          700: '#8494b5',
          800: '#b3bfd6',
          900: '#dbe3f0',
          950: '#f0f4fa',
        },
        primary: {
          color: '#818cf8',
          contrastColor: '#0a0f1d',
          hoverColor: '#a5b4fc',
          activeColor: '#c7d2fe',
        },
        content: {
          background: '#131c31',
          hoverBackground: '#1a2540',
          borderColor: '#22304f',
          color: '#e6edf8',
        },
        formField: {
          background: '#0e1526',
          disabledBackground: '#131c31',
          filledBackground: '#131c31',
          borderColor: '#2c3d61',
          hoverBorderColor: '#3a4d75',
          focusBorderColor: '#818cf8',
          color: '#e6edf8',
          placeholderColor: '#7e8ca8',
        },
        overlay: {
          select: { background: '#131c31', borderColor: '#22304f', color: '#e6edf8' },
          popover: { background: '#131c31', borderColor: '#22304f', color: '#e6edf8' },
          modal: { background: '#131c31', borderColor: '#22304f', color: '#e6edf8' },
        },
      },
    },
  },
});

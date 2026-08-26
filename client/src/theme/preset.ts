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
        // Aura's dark scheme reads this ramp light-to-dark: surface.0 is the
        // brightest foreground and surface.950 the deepest background. It was
        // written the other way round, so every token Aura derives from it —
        // list option text, icons, menu items — came out dark on dark.
        surface: {
          0: '#ffffff',
          50: '#f0f4fa',
          100: '#dbe3f0',
          200: '#b3bfd6',
          300: '#8494b5',
          400: '#5a6d94',
          500: '#3a4d75',
          600: '#2c3d61',
          700: '#22304f',
          800: '#1a2540',
          900: '#131c31',
          950: '#0e1526',
        },
        text: {
          color: '#e9eefb',
          hoverColor: '#ffffff',
          // Same 4.6:1 muted tone the app's own CSS uses.
          mutedColor: '#8b9abc',
          hoverMutedColor: '#aab8d4',
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
          // Field boundaries carry meaning, so they clear 3:1 on every surface
          // they sit on (WCAG non-text contrast).
          borderColor: '#5a72ab',
          hoverBorderColor: '#7b90c4',
          focusBorderColor: '#a5b4fc',
          color: '#e6edf8',
          placeholderColor: '#7e8ca8',
          disabledColor: '#7e8ca8',
          iconColor: '#8b9abc',
          floatLabelColor: '#8b9abc',
          floatLabelActiveColor: '#8b9abc',
        },
        list: {
          // Meaningful icons inside options need 3:1 like any other control mark.
          option: { icon: { color: '#8b9abc', focusColor: '#aab8d4' } },
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

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Palette pensée pour ce sujet précis : la gestion d'argent en
        // couple doit rassurer, pas alerter en permanence. On évite le
        // vert/rouge de trading et le violet SaaS générique.
        ink: '#20302B',        // texte principal, presque noir mais chaud
        cream: '#F6F5F1',      // fond, doux, pas le cream IA-générique (#F4F1EA)
        teal: {
          DEFAULT: '#1F6F63',  // couleur de marque : confiance, stabilité
          light: '#E6EFEC',
          dark: '#153F38',
        },
        amber: {
          DEFAULT: '#D98A2B',  // épargne / objectifs
          light: '#FBEFDD',
        },
        coral: {
          DEFAULT: '#C9615A',  // alertes douces (dépassement), jamais criard
          light: '#F6E4E2',
        },
      },
      fontFamily: {
        sans: ['Figtree', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        card: '20px',
      },
    },
  },
  plugins: [],
};

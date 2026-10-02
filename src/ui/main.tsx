import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@xyflow/react/dist/style.css';
import './vendor/expo-theme.css';
import './styles.css';
import { App } from './App';

// Radix colour scales switch on a class, as on expo.dev, so follow the OS setting.
const dark = matchMedia('(prefers-color-scheme: dark)');
const applyTheme = () => {
  document.documentElement.classList.toggle('dark-theme', dark.matches);
  document.documentElement.classList.toggle('light-theme', !dark.matches);
};
applyTheme();
dark.addEventListener('change', applyTheme);

createRoot(document.getElementById('root')!).render(<App />);

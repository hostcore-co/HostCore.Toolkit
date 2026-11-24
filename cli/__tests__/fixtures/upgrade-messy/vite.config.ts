import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Serves the format-1 dev harness in dev/.
export default defineConfig({ plugins: [react()] })

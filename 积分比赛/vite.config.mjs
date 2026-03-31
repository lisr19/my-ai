import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig({
  plugins: [
    vue(),
    viteSingleFile({
      // 只内联 JS/CSS，不内联图片资源
      useRecommendedBuildConfig: false,
      removeViteModuleLoader: true
    })
  ],
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    minify: 'esbuild',
    cssCodeSplit: false,
    // 不内联任何资源（图片走外部 img/ 目录）
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        // 不要把图片打包进 bundle
        assetFileNames: 'assets/[name]-[hash][extname]'
      }
    }
  }
})

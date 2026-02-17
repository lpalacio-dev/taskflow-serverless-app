import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { Amplify } from 'aws-amplify'
import { amplifyConfig } from '../amplify-config';
import "./assets/main.css";
import App from './App.vue'
import router from './router'

// Inicializar Amplify con la configuración de recursos existentes
Amplify.configure(amplifyConfig)

const app = createApp(App)

app.use(createPinia())
app.use(router)

app.mount('#app')

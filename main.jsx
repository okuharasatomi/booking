import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'

// index.html内にある <div id="root"></div> を探して、Reactアプリを起動させます
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

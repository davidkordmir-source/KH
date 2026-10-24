import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/vazirmatn/400.css';
import '@fontsource/vazirmatn/500.css';
import '@fontsource/vazirmatn/600.css';
import '@fontsource/vazirmatn/700.css';
import './styles.css';

function Failure() {
  return <div dir="rtl" style={{padding:40,fontFamily:'sans-serif',lineHeight:2}} role="alert"><h1>اجرای رابط دیدبان ممکن نشد</h1><p>صفحه را با Ctrl+F5 تازه کنید. اگر مشکل ادامه داشت، برنامه را در نسخهٔ جدید Edge یا Chrome باز کنید.</p><button onClick={() => { location.href = '/?reload=' + Date.now(); }}>تلاش دوباره</button></div>;
}
class Boundary extends React.Component<React.PropsWithChildren, {failed:boolean}> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <Failure /> : this.props.children; }
}
const root = ReactDOM.createRoot(document.getElementById('root')!);
import('./App').then(({default: App}) => {
  root.render(<React.StrictMode><Boundary><App /></Boundary></React.StrictMode>);
}).catch(() => root.render(<Failure />));

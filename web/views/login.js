import { html, useState } from '../vendor/preact-htm.js';
import { sb, useAction, Msg } from '../lib.js';

export function Login() {
  const [mode, setMode] = useState('login');   // login | signup | magic
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const a = useAction();
  const redirect = location.origin + location.pathname;

  const submit = (e) => {
    e.preventDefault();
    a.run(async () => {
      if (mode === 'login') {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw new Error(error.message === 'Invalid login credentials' ? 'E-Mail oder Passwort falsch.' : error.message);
      } else if (mode === 'signup') {
        const { data, error } = await sb.auth.signUp({
          email, password, options: { data: { display_name: name || email.split('@')[0] }, emailRedirectTo: redirect },
        });
        if (error) throw new Error(error.message);
        if (!data.session) a.setMsg({ ok: true, text: 'Fast geschafft: Bitte bestätige die E-Mail, die wir dir geschickt haben.' });
      } else {
        const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect } });
        if (error) throw new Error(error.message);
        a.setMsg({ ok: true, text: 'Link verschickt – schau in dein Postfach.' });
      }
    });
  };

  return html`<main class="wrap narrow">
    <div class="brand"><span class="logo" aria-hidden="true">◎</span> UCI Fantasy</div>
    <div class="card">
      <div class="seg" role="tablist">
        ${[['login', 'Anmelden'], ['signup', 'Registrieren'], ['magic', 'Magic Link']].map(([k, l]) =>
          html`<button type="button" class=${mode === k ? 'active' : ''} onClick=${() => { setMode(k); a.setMsg(null); }}>${l}</button>`)}
      </div>
      <form onSubmit=${submit} class="stack">
        ${mode === 'signup' && html`<label>Name<input value=${name} onInput=${(e) => setName(e.target.value)} autocomplete="nickname" /></label>`}
        <label>E-Mail<input type="email" required value=${email} onInput=${(e) => setEmail(e.target.value)} autocomplete="email" /></label>
        ${mode !== 'magic' && html`<label>Passwort<input type="password" required minlength="6" value=${password}
            onInput=${(e) => setPassword(e.target.value)} autocomplete=${mode === 'signup' ? 'new-password' : 'current-password'} /></label>`}
        <button class="primary" disabled=${a.busy}>
          ${mode === 'login' ? 'Anmelden' : mode === 'signup' ? 'Konto anlegen' : 'Link schicken'}
        </button>
        <${Msg} msg=${a.msg} />
      </form>
    </div>
    <p class="muted small center">Mit einem Einladungslink kommst du nach der Anmeldung direkt in die Liga.</p>
  </main>`;
}

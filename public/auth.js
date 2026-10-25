async function account(body) {
  const response = await fetch('/auth/session', {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Unable to sign in. Please try again.');
  return result;
}

const panel = document.querySelector('#authPanel');
const message = document.querySelector('#authMessage');
const form = document.querySelector('#authForm');
const params = new URLSearchParams(location.hash.slice(1));
const resetToken = params.get('recovery_token');
const inviteToken = params.get('invite_token');

form.addEventListener('submit', async event => {
  event.preventDefault();
  const action = resetToken ? 'reset' : inviteToken ? 'invite' : event.submitter?.value || 'login';
  const button = event.submitter;
  if (button) button.disabled = true;
  message.textContent = 'Working…';
  try {
    const result = await account({ action, email: form.elements.email.value, password: form.elements.password.value, token: resetToken || inviteToken });
    if (result.message) message.textContent = result.message;
    else { history.replaceState(null, '', location.pathname); location.reload(); }
  } catch (error) { message.textContent = error.message; }
  finally { if (button) button.disabled = false; }
});

document.querySelector('#forgotPassword').addEventListener('click', async () => {
  if (!form.elements.email.reportValidity()) return;
  try { message.textContent = (await account({ action: 'recover', email: form.elements.email.value })).message; }
  catch (error) { message.textContent = error.message; }
});

async function start() {
  if (resetToken || inviteToken) {
    document.querySelector('#authTitle').textContent = resetToken ? 'Choose a new password' : 'Welcome to your inbox';
    document.querySelector('#signIn').textContent = 'Save password';
    document.querySelector('#signUp').hidden = true;
    document.querySelector('#forgotPassword').hidden = true;
    form.elements.email.required = false;
    form.elements.email.closest('label').hidden = true;
    return;
  }
  try {
    const confirmation = params.get('confirmation_token');
    if (confirmation) {
      await account({ action: 'confirm', token: confirmation });
      history.replaceState(null, '', location.pathname);
      location.reload();
      return;
    }
    const { user } = await account();
    if (!user) return;
    panel.hidden = true;
    document.querySelector('#workspace').hidden = false;
    document.querySelector('#signOut').hidden = false;
    document.querySelector('#mobileAdd').hidden = false;
    document.querySelector('.greeting').textContent = 'Your personal inbox';
    await import('./app.js');
  } catch (error) { message.textContent = error.message; }
}

document.querySelector('#signOut').addEventListener('click', async () => {
  try { await account({ action: 'logout' }); location.reload(); }
  catch (error) { message.textContent = error.message; panel.hidden = false; }
});

start();

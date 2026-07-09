fetch('http://127.0.0.1:54321/auth/v1/health')
  .then(res => res.json())
  .then(json => console.log('SUCCESS:', json))
  .catch(err => console.error('FAILED:', err));

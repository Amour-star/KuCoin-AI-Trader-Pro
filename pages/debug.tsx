export default function Debug() {
  return (
    <div>
      <h1>Debug Info</h1>
      <p>API_URL: {process.env.NEXT_PUBLIC_API_URL || 'NOT SET'}</p>
    </div>
  );
}

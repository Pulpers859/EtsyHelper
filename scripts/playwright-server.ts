process.env.NODE_ENV = 'production';
process.env.PORT = process.env.PORT || '3410';

await import('../server.ts');

export async function runSeedInTransaction<Tx>(
  client: {
    $transaction<T>(operation: (tx: Tx) => Promise<T>): Promise<T>;
  },
  operation: (tx: Tx) => Promise<void>,
) {
  await client.$transaction(operation);
}

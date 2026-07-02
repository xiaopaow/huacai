const databaseName = "huacai-amazon-assets";
const storeName = "images";
const databaseVersion = 1;

export interface StoredImage {
  id: string;
  taskId: string;
  productId: string;
  name: string;
  type: string;
  size: number;
  createdAt: number;
  blob: Blob;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(storeName)) {
        const store = database.createObjectStore(storeName, { keyPath: "id" });
        store.createIndex("taskId", "taskId");
        store.createIndex("productId", "productId");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveTaskImages(
  taskId: string,
  productId: string,
  files: File[],
): Promise<string[]> {
  const database = await openDatabase();
  const ids = files.map((_, index) => `${taskId}-${index + 1}-${crypto.randomUUID()}`);

  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);
    files.forEach((file, index) => {
      const image: StoredImage = {
        id: ids[index],
        taskId,
        productId,
        name: file.name,
        type: file.type,
        size: file.size,
        createdAt: Date.now(),
        blob: file,
      };
      store.put(image);
    });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });

  database.close();
  return ids;
}

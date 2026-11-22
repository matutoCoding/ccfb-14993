import '@/style.css'
import { openDb } from '@/db/database'
import { seedIfEmpty } from '@/db/seed'
import { mountApp } from '@/app'

const main = async (): Promise<void> => {
  await openDb()
  await seedIfEmpty()
  const el = document.getElementById('app')
  if (el) mountApp(el)
}

void main()

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Toaster } from 'sonner'

export default async function TechLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  return (
    <div className="mx-auto min-h-screen max-w-lg bg-slate-50 shadow-sm">
      {children}
      <Toaster position="top-center" richColors />
    </div>
  )
}

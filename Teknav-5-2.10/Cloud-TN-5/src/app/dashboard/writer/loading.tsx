import { Card, CardContent } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';

/**
 * Writer Loading Page
 */

export default function LoadingPage() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <Card>
        <CardContent className="p-8 flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Loading...</p>
        </CardContent>
      </Card>
    </div>
  );
}

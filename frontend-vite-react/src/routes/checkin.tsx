import { createFileRoute } from '@tanstack/react-router';
import { CheckIn } from '@/pages/checkin';

export const Route = createFileRoute('/checkin')({
  component: CheckIn,
});

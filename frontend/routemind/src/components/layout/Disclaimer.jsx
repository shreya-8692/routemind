import { DISCLAIMER } from '../../constants/emergency';

export default function Disclaimer({ compact = false }) {
  return (
    <p className={`disclaimer${compact ? ' disclaimer--compact' : ''}`}>
      <strong>Safety notice:</strong> {DISCLAIMER}
    </p>
  );
}

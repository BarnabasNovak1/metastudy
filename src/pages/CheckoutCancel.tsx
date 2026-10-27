import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

const CheckoutCancel = () => {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="text-3xl font-bold">Checkout canceled</div>
        <p className="text-muted-foreground">Your payment was not completed. You can try again or continue exploring plans.</p>
        <div className="flex gap-3 justify-center">
          <Button onClick={() => navigate('/pricing')}>View Plans</Button>
          <Button variant="outline" onClick={() => navigate('/')}>Go Home</Button>
        </div>
      </div>
    </div>
  );
};

export default CheckoutCancel;

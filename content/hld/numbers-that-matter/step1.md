Start at the front door. The only number the load balancer and app servers care about is requests a second at the peak, because that sets how many app servers you need.

With the URL-shortener preset (20 million daily users, 20 requests each, a 3× peak) that is about 14,000 requests a second. The figure sizes the app tier at 60% target utilisation, so you can see the instance count change as you move the inputs.

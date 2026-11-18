from . import push


class PushKickMiddleware:
    """Hands queued push notifications over once per request, after the view's commits."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        token = push.begin_request()
        try:
            response = self.get_response(request)
        finally:
            pending = push.end_request(token)
        if pending:
            push.kick()
        return response

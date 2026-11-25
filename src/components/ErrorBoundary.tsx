import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'Đã xảy ra lỗi không mong muốn.',
    };
  }

  componentDidCatch(error: Error): void {
    console.error('Application ErrorBoundary caught:', error);
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div className="min-h-dvh w-full flex items-center justify-center bg-[#0d0603] p-4 text-amber-100">
          <div className="max-w-md w-full rounded-2xl border border-amber-500/50 bg-[#1c0e06] p-6 text-center space-y-4 shadow-2xl">
            <h2 className="font-display text-lg font-extrabold text-amber-300">
              Hệ thống tạm thời gặp sự cố
            </h2>
            <p className="text-xs text-amber-200/80 break-words">{this.state.message}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-5 py-2 rounded-full bg-gradient-to-b from-amber-300 to-amber-500 text-amber-950 font-bold text-sm hover:brightness-105"
            >
              Tải lại trang
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

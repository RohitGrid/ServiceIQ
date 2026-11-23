'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useOrg } from '@/hooks/use-org';
import { createClient } from '@/lib/supabase/client';
import type { Priority, TicketSource } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import {
  AlertCircle,
  PlusCircle,
  ArrowLeft,
  Building2,
  MapPin,
  Wrench,
  Search,
  Check,
  ChevronDown,
  X,
  Phone,
  ShieldAlert,
} from 'lucide-react';
import Link from 'next/link';

interface CustomerOption {
  party_id: string;
  name: string;
  phone?: string | null;
}

interface SiteOption {
  site_id: string;
  name: string;
  address?: string | null;
}

interface UnitOption {
  unit_id: string;
  serial_no?: string | null;
  model_name: string;
  brand_name?: string | null;
}

export function TicketForm() {
  const router = useRouter();
  const { org } = useOrg();

  const [source, setSource] = useState<TicketSource>('phone');
  const [priority, setPriority] = useState<Priority>('P2');
  const [faultDescription, setFaultDescription] = useState<string>('');

  // Dropdown options and selections
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerOption | null>(null);
  const [customerSearch, setCustomerSearch] = useState<string>('');
  const [isCustomerDropdownOpen, setIsCustomerDropdownOpen] = useState<boolean>(false);
  const customerDropdownRef = useRef<HTMLDivElement>(null);

  const [sites, setSites] = useState<SiteOption[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<string>('');

  const [units, setUnits] = useState<UnitOption[]>([]);
  const [selectedUnitId, setSelectedUnitId] = useState<string>('');

  const [loadingInitial, setLoadingInitial] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // 1. Fetch Customers for this organization
  useEffect(() => {
    if (!org?.org_id) return;

    async function loadCustomers() {
      setLoadingInitial(true);
      const supabase = createClient();
      const { data, error } = await supabase
        .from('party')
        .select('party_id, name, phone')
        .eq('org_id', org.org_id)
        .order('name');

      if (!error && data) {
        setCustomers(data);
      }
      setLoadingInitial(false);
    }

    loadCustomers();
  }, [org?.org_id]);

  // Handle outside click for customer combobox
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        customerDropdownRef.current &&
        !customerDropdownRef.current.contains(event.target as Node)
      ) {
        setIsCustomerDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 2. Fetch Sites when Customer changes
  useEffect(() => {
    if (!selectedCustomer) {
      setSites([]);
      setSelectedSiteId('');
      return;
    }

    const customerId = selectedCustomer.party_id;

    async function loadSites() {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('site')
        .select('site_id, name, address')
        .eq('party_id', customerId)
        .order('name');

      if (!error && data) {
        setSites(data);
        if (data.length === 1) {
          setSelectedSiteId(data[0].site_id);
        } else {
          setSelectedSiteId('');
        }
      }
    }

    loadSites();
  }, [selectedCustomer]);

  // 3. Fetch Equipment Units when Site changes
  useEffect(() => {
    if (!selectedSiteId) {
      setUnits([]);
      setSelectedUnitId('');
      return;
    }

    async function loadUnits() {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('equipment_unit')
        .select('unit_id, serial_no, product_model(name, brand_name)')
        .eq('site_id', selectedSiteId)
        .order('created_at', { ascending: false });

      if (!error && data) {
        const mapped: UnitOption[] = data.map((u: any) => {
          const model = Array.isArray(u.product_model) ? u.product_model[0] : u.product_model;
          return {
            unit_id: u.unit_id,
            serial_no: u.serial_no,
            model_name: model?.name || 'Standard Equipment',
            brand_name: model?.brand_name,
          };
        });
        setUnits(mapped);
        if (mapped.length === 1) {
          setSelectedUnitId(mapped[0].unit_id);
        } else {
          setSelectedUnitId('');
        }
      }
    }

    loadUnits();
  }, [selectedSiteId]);

  // Filtered customer list for combobox
  const filteredCustomers = customers.filter(
    (c) =>
      c.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
      (c.phone && c.phone.includes(customerSearch))
  );

  function validate() {
    const errors: Record<string, string> = {};
    if (!faultDescription.trim()) {
      errors.faultDescription = 'Fault description is required.';
    } else if (faultDescription.trim().length < 5) {
      errors.faultDescription = 'Please provide a more detailed description (at least 5 characters).';
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!org?.org_id) return;

    if (!validate()) {
      setErrorMessage('Please fix the errors below before submitting.');
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);

    try {
      const selectedSite = sites.find((s) => s.site_id === selectedSiteId);

      // Call transactional endpoint with automatic rollback & Track E integration
      const response = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId: org.org_id,
          siteId: selectedSiteId || null,
          unitId: selectedUnitId || null,
          source,
          priority,
          faultDescription: faultDescription.trim(),
          customerName: selectedCustomer?.name,
          customerPhone: selectedCustomer?.phone,
          siteName: selectedSite?.name,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to create ticket');
      }

      // Success: redirect to live dispatch board
      router.push('/dispatch');
    } catch (err: any) {
      setErrorMessage(err.message || 'An error occurred during ticket creation');
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/tickets">
          <Button variant="ghost" size="sm" className="gap-1">
            <ArrowLeft className="w-4 h-4" />
            Back to Tickets
          </Button>
        </Link>
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-xl flex items-center gap-2">
            <PlusCircle className="w-5 h-5 text-primary" />
            Raise New Service Ticket
          </CardTitle>
          <CardDescription>
            Intake an inbound customer fault report. This automatically generates a breakdown job and queues it onto the live dispatch board.
          </CardDescription>
        </CardHeader>

        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-6">
            {errorMessage && (
              <div className="p-3.5 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-sm flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Source & Priority */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="source-select">Intake Channel / Source</Label>
                <select
                  id="source-select"
                  value={source}
                  onChange={(e) => setSource(e.target.value as TicketSource)}
                  className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="phone">Phone Call</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="email">Email</option>
                  <option value="portal">Customer Portal</option>
                  <option value="walk_in">Walk-in</option>
                </select>
              </div>

              <div className="space-y-2">
                <Label>Priority Level</Label>
                <div className="flex items-center gap-3 pt-1">
                  {(['P1', 'P2', 'P3'] as Priority[]).map((p) => (
                    <label
                      key={p}
                      className={`flex-1 flex items-center justify-center gap-1.5 p-2 rounded-md border text-xs font-semibold cursor-pointer transition-colors ${
                        priority === p
                          ? p === 'P1'
                            ? 'bg-rose-50 border-rose-500 text-rose-700 dark:bg-rose-950/30 dark:text-rose-400'
                            : p === 'P2'
                            ? 'bg-amber-50 border-amber-500 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400'
                            : 'bg-muted border-primary text-foreground'
                          : 'hover:bg-muted/50 border-border text-muted-foreground'
                      }`}
                    >
                      <input
                        type="radio"
                        name="priority"
                        value={p}
                        checked={priority === p}
                        onChange={() => setPriority(p)}
                        className="sr-only"
                      />
                      <span>
                        {p} {p === 'P1' ? '(High)' : p === 'P2' ? '(Normal)' : '(Low)'}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {/* Customer Searchable Combobox */}
            <div className="space-y-2" ref={customerDropdownRef}>
              <Label className="flex items-center gap-1.5">
                <Building2 className="w-4 h-4 text-muted-foreground" />
                Customer Party
              </Label>
              <div className="relative">
                <div
                  onClick={() => setIsCustomerDropdownOpen(!isCustomerDropdownOpen)}
                  className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm flex items-center justify-between cursor-pointer focus-within:ring-2 focus-within:ring-ring"
                >
                  <span className={selectedCustomer ? 'text-foreground font-medium' : 'text-muted-foreground'}>
                    {selectedCustomer
                      ? `${selectedCustomer.name} ${selectedCustomer.phone ? `(${selectedCustomer.phone})` : ''}`
                      : 'Search or select customer party...'}
                  </span>
                  <div className="flex items-center gap-1 text-muted-foreground">
                    {selectedCustomer && (
                      <X
                        className="w-4 h-4 hover:text-foreground cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedCustomer(null);
                          setSelectedSiteId('');
                          setSelectedUnitId('');
                        }}
                      />
                    )}
                    <ChevronDown className="w-4 h-4" />
                  </div>
                </div>

                {isCustomerDropdownOpen && (
                  <div className="absolute z-50 left-0 right-0 top-11 bg-popover text-popover-foreground border rounded-md shadow-lg p-2 space-y-2 animate-in fade-in-0 zoom-in-95">
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
                      <Input
                        type="text"
                        placeholder="Search customer by name or phone..."
                        value={customerSearch}
                        onChange={(e) => setCustomerSearch(e.target.value)}
                        autoFocus
                        className="h-8 pl-8 text-xs"
                      />
                    </div>
                    <div className="max-h-48 overflow-y-auto space-y-0.5">
                      {filteredCustomers.length === 0 ? (
                        <div className="text-xs text-muted-foreground p-3 text-center">
                          {loadingInitial ? 'Loading customer list...' : 'No customers match your search.'}
                        </div>
                      ) : (
                        filteredCustomers.map((c) => {
                          const isSelected = selectedCustomer?.party_id === c.party_id;
                          return (
                            <div
                              key={c.party_id}
                              onClick={() => {
                                setSelectedCustomer(c);
                                setIsCustomerDropdownOpen(false);
                                setCustomerSearch('');
                              }}
                              className={`flex items-center justify-between px-2.5 py-1.5 rounded text-xs cursor-pointer hover:bg-muted ${
                                isSelected ? 'bg-primary/10 font-semibold text-primary' : ''
                              }`}
                            >
                              <div>
                                <p>{c.name}</p>
                                {c.phone && <p className="text-[10px] text-muted-foreground">{c.phone}</p>}
                              </div>
                              {isSelected && <Check className="w-3.5 h-3.5 text-primary" />}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Cascading Site Selection */}
            <div className="space-y-2">
              <Label htmlFor="site-select" className="flex items-center gap-1.5">
                <MapPin className="w-4 h-4 text-muted-foreground" />
                Customer Site Location
              </Label>
              <select
                id="site-select"
                value={selectedSiteId}
                onChange={(e) => setSelectedSiteId(e.target.value)}
                disabled={!selectedCustomer || sites.length === 0}
                className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                <option value="">
                  {!selectedCustomer
                    ? 'Select a customer above first'
                    : sites.length === 0
                    ? 'No sites registered for customer (will use primary site)'
                    : '-- Select Site Location --'}
                </option>
                {sites.map((s) => (
                  <option key={s.site_id} value={s.site_id}>
                    {s.name} {s.address ? `(${s.address})` : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Cascading Equipment Unit Selection */}
            <div className="space-y-2">
              <Label htmlFor="unit-select" className="flex items-center gap-1.5">
                <Wrench className="w-4 h-4 text-muted-foreground" />
                Equipment Unit (Serial Number & Product Model)
              </Label>
              <select
                id="unit-select"
                value={selectedUnitId}
                onChange={(e) => setSelectedUnitId(e.target.value)}
                disabled={!selectedSiteId || units.length === 0}
                className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                <option value="">
                  {!selectedSiteId
                    ? 'Select a site location first'
                    : units.length === 0
                    ? 'No equipment units installed at this site'
                    : '-- Select Equipment Unit --'}
                </option>
                {units.map((u) => (
                  <option key={u.unit_id} value={u.unit_id}>
                    {u.model_name} {u.brand_name ? `[${u.brand_name}]` : ''} — Serial: {u.serial_no || 'N/A'}
                  </option>
                ))}
              </select>
            </div>

            {/* Fault Description */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="fault-desc">Fault Description / Customer Complaint *</Label>
                {fieldErrors.faultDescription && (
                  <span className="text-xs text-rose-600 font-medium">
                    {fieldErrors.faultDescription}
                  </span>
                )}
              </div>
              <Textarea
                id="fault-desc"
                rows={4}
                placeholder="Describe the defect or fault reported by customer (e.g., AC cooling low, compressor overheating, error code E4 on display)..."
                value={faultDescription}
                onChange={(e) => {
                  setFaultDescription(e.target.value);
                  if (fieldErrors.faultDescription) {
                    setFieldErrors((prev) => ({ ...prev, faultDescription: '' }));
                  }
                }}
                className={fieldErrors.faultDescription ? 'border-rose-500 focus-visible:ring-rose-500' : ''}
                required
              />
            </div>

            {/* SLA Preview Banner */}
            <div className="rounded-lg bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200/60 p-3.5 text-xs text-blue-900 dark:text-blue-200 flex items-start gap-2.5">
              <ShieldAlert className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <p className="font-semibold">Automatic Dispatch & SLA Orchestration</p>
                <p className="text-blue-800/80 dark:text-blue-300/80 leading-relaxed">
                  Submitting this ticket automatically generates a field service breakdown job with initial &apos;Open&apos; workflow status and sets SLA deadlines (Target Response: {priority === 'P1' ? '1 hour' : priority === 'P2' ? '4 hours' : '8 hours'}).
                </p>
              </div>
            </div>
          </CardContent>

          <CardFooter className="flex justify-between border-t pt-4">
            <Link href="/tickets">
              <Button type="button" variant="outline" disabled={submitting}>
                Cancel
              </Button>
            </Link>
            <Button
              type="submit"
              disabled={submitting || !faultDescription.trim()}
              className="gap-2"
            >
              {submitting ? 'Creating & Dispatching...' : 'Create Ticket & Queue Job'}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
